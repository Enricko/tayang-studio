---
name: a2ui-options
description: Use inside Tayang Studio whenever you offer choices, ask yes or no, ask for a few fields, or show topic ideas. Shows them as tappable A2UI v0.9 cards in the chat instead of plain text.
---

# A2UI options

Tayang's chat draws A2UI v0.9 surfaces. Use one any time you offer choices, ask yes or no, ask for a few fields, or show topic ideas.

## Format

Write a fenced block with the language `a2ui`. One JSON message per line. Every message has `"version":"v0.9"`.

```a2ui
{"version":"v0.9","createSurface":{"surfaceId":"pick","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
{"version":"v0.9","updateComponents":{"surfaceId":"pick","components":[{"id":"root","component":"Text","text":"Hello","variant":"body"}]}}
```

Messages:

- `createSurface {surfaceId, catalogId}`: starts a surface. Use the catalog URL above.
- `updateComponents {surfaceId, components:[{id, component, ...props}]}`: the components. One must have `"id":"root"`.
- `updateDataModel {surfaceId, path, value}`: sets data. `path` is a JSON Pointer such as `/topic`.
- `deleteSurface {surfaceId}`: removes the surface.

## Components

- `Card`: `child` (id).
- `Column`, `Row`, `List`: `children` (array of ids, or `{"componentId":"item","path":"/items"}` to repeat a template), `justify`, `align`.
- `Text`: `text`, `variant` (h1 to h5, body, caption).
- `Image`: `url`. `Icon`: `name`. `Divider`: `axis`.
- `Button`: `child` (id of a Text), `variant`, `action`: `{"event":{"name":"...","context":{"key":{"path":"/x"}}}}`. A context value is a path or a literal.
- `TextField`: `label`, `value` (binding).
- `CheckBox`: `label`, `value` (binding).
- `Slider`: `value` (binding), `minValue`, `maxValue`.
- `ChoicePicker`: `options` (`[{"label","value"}]`), `selections` (binding), `maxAllowedSelections`.
- `Tabs`: `tabItems` (`[{"title","child"}]`).

## Data binding

A binding is `{"path":"/topic"}`. Set a starting value with `updateDataModel`, for example `{"version":"v0.9","updateDataModel":{"surfaceId":"form","path":"/topic","value":""}}`. The user's edits update the model, and a Button sends the values you list in its `context`.

## What you get back

When the user presses a Button you receive one message:

```json
{"version":"v0.9","action":{"name":"pick_option","surfaceId":"pick","sourceComponentId":"go","timestamp":"2026-11-04T10:00:00Z","context":{"choice":["b"]}}}
```

Read `name` and `context`, then continue. Send `deleteSurface` when the question is answered.

The event name `pick_topic` is reserved for topic ideas: a "Make this" button whose context is `title`, `kind`, `lengthSec` and `styleId` (see the tayang-studio skill). Name every other event yourself, such as `pick_option`.

## Example 1: pick one of 3 options

```a2ui
{"version":"v0.9","createSurface":{"surfaceId":"pick","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
{"version":"v0.9","updateDataModel":{"surfaceId":"pick","path":"/choice","value":[]}}
{"version":"v0.9","updateComponents":{"surfaceId":"pick","components":[{"id":"root","component":"Card","child":"col"},{"id":"col","component":"Column","children":["title","picker","go"]},{"id":"title","component":"Text","text":"Which voice do you want","variant":"h4"},{"id":"picker","component":"ChoicePicker","options":[{"label":"Calm","value":"a"},{"label":"Upbeat","value":"b"},{"label":"News anchor","value":"c"}],"selections":{"path":"/choice"},"maxAllowedSelections":1},{"id":"go","component":"Button","child":"go-text","variant":"primary","action":{"event":{"name":"pick_option","context":{"choice":{"path":"/choice"}}}}},{"id":"go-text","component":"Text","text":"Use this voice"}]}}
```

## Example 2: confirm before a big change

```a2ui
{"version":"v0.9","createSurface":{"surfaceId":"confirm","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
{"version":"v0.9","updateComponents":{"surfaceId":"confirm","components":[{"id":"root","component":"Card","child":"col"},{"id":"col","component":"Column","children":["msg","row"]},{"id":"msg","component":"Text","text":"I will change the style of all 8 scenes. Continue","variant":"body"},{"id":"row","component":"Row","children":["no","yes"],"justify":"end"},{"id":"no","component":"Button","child":"no-text","action":{"event":{"name":"confirm_no"}}},{"id":"no-text","component":"Text","text":"Not now"},{"id":"yes","component":"Button","child":"yes-text","variant":"primary","action":{"event":{"name":"confirm_yes"}}},{"id":"yes-text","component":"Text","text":"Change all scenes"}]}}
```

## Example 3: a short form with two fields

```a2ui
{"version":"v0.9","createSurface":{"surfaceId":"form","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
{"version":"v0.9","updateDataModel":{"surfaceId":"form","path":"/title","value":""}}
{"version":"v0.9","updateDataModel":{"surfaceId":"form","path":"/seconds","value":30}}
{"version":"v0.9","updateComponents":{"surfaceId":"form","components":[{"id":"root","component":"Card","child":"col"},{"id":"col","component":"Column","children":["title","len","go"]},{"id":"title","component":"TextField","label":"Video title","value":{"path":"/title"}},{"id":"len","component":"Slider","value":{"path":"/seconds"},"minValue":15,"maxValue":90},{"id":"go","component":"Button","child":"go-text","variant":"primary","action":{"event":{"name":"submit_form","context":{"title":{"path":"/title"},"seconds":{"path":"/seconds"}}}}},{"id":"go-text","component":"Text","text":"Start"}]}}
```

## Rules

- One surface per question. Delete it once answered.
- Short labels in sentence case. No exclamation marks.
- Text only in `Text`, `label` and `title` fields. No HTML, no Markdown inside surfaces.
- Keep the words around the block to one short line.
