package ingest

// Action is what ingest does with a received hook_event fact (DESIGN "Capture and event policy").
type Action int

const (
	// Keep stores the slim envelope; the row hash is the full received envelope's.
	Keep Action = iota
	// Remove stores nothing: no fact row and no archive line.
	Remove
	// Trimmed deletes one dead-weight path from the payload (see Trim), then stores the event as
	// Keep does. The row hash and archive line are those of the trimmed object.
	Trimmed
)

func (a Action) String() string {
	switch a {
	case Remove:
		return "remove"
	case Trimmed:
		return "trim"
	}
	return "keep"
}

type policyKey struct{ harness, event string }

// policyTable maps (harness, event) to an action. Any pair not listed is Keep. The OpenCode Remove
// entries must equal the plugin's remove-list, and the OpenCode Trimmed entries its trim-list, in
// packages/opencode-yakka-hooks/src/index.ts (asserted by TestRemoveListMatchesPlugin and
// TestTrimListMatchesPlugin).
var policyTable = map[policyKey]Action{
	{"opencode", "experimental.chat.system.transform"}: Remove,
	{"opencode", "chat.params"}:                        Remove,
	{"opencode", "chat.headers"}:                       Remove,
	{"opencode", "shell.env"}:                          Remove,
	{"opencode", "message.part.delta"}:                 Remove,
	{"opencode", "message.part.updated"}:               Remove,
	{"opencode", "session.status"}:                     Remove,
	{"opencode", "session.updated"}:                    Remove,
	{"opencode", "session.diff"}:                       Remove,
	{"opencode", "message.updated"}:                    Trimmed,
}

// trimPath is the path Trim deletes, below the fact's payload. OpenCode repeats the session's
// cumulative patches in every message.updated; artifact versions and commits already cover them.
var trimPath = []string{"event", "properties", "info", "summary", "diffs"}

// Policy returns the action for a hook_event fact. The payload is accepted for callers that key a
// decision on it, though no current entry does.
func Policy(harness, event string, payload map[string]any) Action {
	return policyTable[policyKey{harness, event}]
}

// Trim applies the trim policy to a decoded fact in place and reports whether it removed anything.
// It acts only on a hook_event whose (harness, event) has the Trim action, and deletes only
// payload.event.properties.info.summary.diffs. Ingest and sync call
// this one function (the OpenCode plugin mirrors it), so an event hashes the same however it arrived.
func Trim(obj map[string]any) bool {
	harness, _ := obj["harness"].(string)
	event, _ := obj["event"].(string)
	if typ, _ := obj["type"].(string); typ != "hook_event" || Policy(harness, event, nil) != Trimmed {
		return false
	}
	cur, _ := obj["payload"].(map[string]any)
	for _, k := range trimPath[:len(trimPath)-1] {
		if cur == nil {
			return false
		}
		cur, _ = cur[k].(map[string]any)
	}
	last := trimPath[len(trimPath)-1]
	if _, ok := cur[last]; cur == nil || !ok {
		return false
	}
	delete(cur, last)
	return true
}
