// A tiny Agent Client Protocol agent for the acp_test integration tests.
// Speaks newline-delimited JSON-RPC 2.0 over stdio. No dependencies.
//
// Prompts (the concatenated text blocks of session/prompt):
//   hello      -> text "Hel", text "lo", end_turn
//   think      -> thought, tool_call pending, update in_progress, update completed, end_turn
//   install    -> tool_call + session/request_permission (allow-once / reject-once),
//                 then text "installed" (allowed) or "skipped" (rejected or cancelled)
//   crash      -> one text chunk, then exit code 1 mid-turn
//   wait       -> waits for session/cancel, then stopReason "cancelled"
//   fs-outside -> fs/write_text_file to a path outside cwd, reports "fs-ok" or "fs-error: <message>"
//   fs-inside  -> writes then reads notes/inside.txt inside cwd, reports "read: <content>"
//   any prompt with an image block -> text "image <mimeType> <data>"
import { createInterface } from "node:readline";
import path from "node:path";

let nextId = 1;
const pending = new Map();
let sessionId = null;
let sessionCwd = null;
let cancelWaiter = null;
let cancelled = false;

function send(msg) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
}

function request(method, params) {
  const id = nextId++;
  send({ id, method, params });
  return new Promise((resolve) => pending.set(id, resolve));
}

function update(u) {
  send({ method: "session/update", params: { sessionId, update: u } });
}

function text(t) {
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
}

async function runPrompt(params) {
  cancelled = false;
  const blocks = params.prompt ?? [];
  const image = blocks.find((b) => b.type === "image");
  if (image) {
    text(`image ${image.mimeType} ${image.data}`);
    return "end_turn";
  }
  const prompt = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  switch (prompt) {
    case "hello":
      text("Hel");
      text("lo");
      return "end_turn";
    case "think":
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "pondering" } });
      update({ sessionUpdate: "tool_call", toolCallId: "t9", title: "Read brief", kind: "read", status: "pending" });
      update({ sessionUpdate: "tool_call_update", toolCallId: "t9", status: "in_progress" });
      update({ sessionUpdate: "tool_call_update", toolCallId: "t9", status: "completed" });
      return "end_turn";
    case "install": {
      const rawInput = { command: "brew install ffmpeg" };
      update({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Install FFmpeg",
        kind: "execute",
        status: "pending",
        rawInput,
      });
      const res = await request("session/request_permission", {
        sessionId,
        toolCall: { toolCallId: "t1", title: "Install FFmpeg", rawInput },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      const outcome = res.result?.outcome;
      if (outcome?.outcome === "selected" && outcome.optionId === "allow") {
        update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
        text("installed");
        return "end_turn";
      }
      update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" });
      text("skipped");
      return cancelled ? "cancelled" : "end_turn";
    }
    case "crash":
      text("about to crash");
      setTimeout(() => process.exit(1), 50);
      return new Promise(() => {});
    case "wait":
      return new Promise((resolve) => {
        cancelWaiter = resolve;
      });
    case "fs-outside": {
      const target = path.join(sessionCwd, "..", `tayang-outside-${process.pid}.txt`);
      const res = await request("fs/write_text_file", { sessionId, path: target, content: "nope" });
      text(res.error ? `fs-error: ${res.error.message}` : "fs-ok");
      return "end_turn";
    }
    case "fs-inside": {
      const target = path.join(sessionCwd, "notes", "inside.txt");
      const w = await request("fs/write_text_file", { sessionId, path: target, content: "one\ntwo\nthree" });
      if (w.error) {
        text(`fs-error: ${w.error.message}`);
        return "end_turn";
      }
      const r = await request("fs/read_text_file", { sessionId, path: target, line: 2, limit: 1 });
      text(r.error ? `fs-error: ${r.error.message}` : `read: ${r.result.content}`);
      return "end_turn";
    }
    default:
      text(`unknown prompt: ${prompt}`);
      return "end_turn";
  }
}

function handle(msg) {
  if (msg.method === undefined) {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
    return;
  }
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const caps = params?.clientCapabilities ?? {};
      const ok =
        params?.protocolVersion === 1 &&
        caps.fs?.readTextFile === true &&
        caps.fs?.writeTextFile === true &&
        caps.terminal === false;
      if (!ok) {
        send({ id, error: { code: -32602, message: "bad initialize params" } });
        return;
      }
      send({
        id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false, promptCapabilities: { image: true } },
          authMethods: [],
        },
      });
      return;
    }
    case "session/new":
      if (typeof params?.cwd !== "string" || !Array.isArray(params?.mcpServers)) {
        send({ id, error: { code: -32602, message: "bad session/new params" } });
        return;
      }
      sessionCwd = params.cwd;
      sessionId = "sess-1";
      send({ id, result: { sessionId } });
      return;
    case "session/prompt":
      if (params?.sessionId !== sessionId) {
        send({ id, error: { code: -32602, message: "unknown session" } });
        return;
      }
      runPrompt(params).then((stopReason) => send({ id, result: { stopReason } }));
      return;
    case "session/cancel":
      cancelled = true;
      if (cancelWaiter) {
        const resolve = cancelWaiter;
        cancelWaiter = null;
        resolve("cancelled");
      }
      return;
    default:
      if (id !== undefined) {
        send({ id, error: { code: -32601, message: `method not found: ${method}` } });
      }
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  handle(JSON.parse(line));
});
rl.on("close", () => process.exit(0));
