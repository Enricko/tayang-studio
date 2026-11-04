import type { AgentId, PermissionRequest } from '@tayang/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { AGENT_NAMES } from '@/lib/agents';

/** The option the "Allow" button maps to: only allow-once. Never allow-always. */
export function allowOption(request: PermissionRequest) {
  return request.options.find((o) => o.kind === 'allow-once');
}

export function PermissionCard({
  request,
  ask,
  agentId = 'claude',
  allowLabel = 'Allow and install',
  onRespond,
}: {
  request: PermissionRequest;
  ask?: string;
  agentId?: AgentId;
  allowLabel?: string;
  onRespond(optionId: string | null): void;
}) {
  const agent = AGENT_NAMES[agentId];
  const allow = allowOption(request);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-hairline bg-ink p-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-text-3">Tayang asked {agent}</span>
        <span className="font-serif text-sm leading-normal text-[#D9D9D9]" style={{ fontFamily: 'Lora, Georgia, serif' }}>
          {ask ?? request.title}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2 text-xs text-text-3">
          <AgentLogo id={agentId} size={14} />
          {agent} wants to run
        </span>
        <pre className="m-0 rounded-sm border border-border bg-sidebar px-3 py-2 font-mono text-xs leading-[1.7] whitespace-pre-line text-foreground">
          {request.commands.join('\n')}
        </pre>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {allow && (
          <Button
            variant="light"
            className="h-9 px-3 text-[13px] font-semibold"
            onClick={() => onRespond(allow.id)}
          >
            {allowLabel}
          </Button>
        )}
        <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => onRespond(null)}>
          Cancel
        </Button>
        <span className="ml-auto text-xs text-text-3">
          {allow ? 'Runs with your user account. It may ask for your password' : "This request can't be allowed once"}
        </span>
      </div>
    </div>
  );
}
