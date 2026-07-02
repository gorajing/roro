// src/executor/__fixtures__/claudeSdkSample.ts — a LIVE-CAPTURED Agent-SDK message stream
// (@anthropic-ai/claude-agent-sdk 0.3.198 ⇄ claude CLI 2.1.198, captured 2026-07-02 on macOS arm64,
// subscription auth). Trimmed to exactly the fields the mapper reads — the same SDKMessage shapes
// sdk.d.ts declares (SDKSystemMessage.init, SDKAssistantMessage.message.content blocks,
// SDKUserMessage tool_result blocks, SDKPartialAssistantMessage stream_event, SDKResultSuccess).
//
// This is the C4 format-drift tripwire: the SDK adapter REUSES the CLI mapper
// (mapClaudeMessage/mapClaudeMessageBlocks/mapClaudeStreamEvent) verbatim, so a captured SDK stream
// must map to the SAME canonical kind-sequence the CLI sample does. If an upstream rename makes
// events vanish, fixtures.test.ts fails loudly instead of the product quietly showing an empty feed.
//
// Captured turn: write ./hello.py, run it with python3, confirm it printed hi.
export const CLAUDE_SDK_STREAM_SAMPLE: unknown[] = [
  { type: 'system', subtype: 'init', session_id: 'f56c0c67-252f-4e6f-be7a-3aefdd6e72d2' },
  {
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking: '' }] },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'toolu_01Uk9v4zNVBLBQaeWQhQ6Ce9', name: 'Write', input: { file_path: './hello.py', content: 'print("hi")\n' } },
      ],
    },
  },
  {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_01Uk9v4zNVBLBQaeWQhQ6Ce9', content: 'File created successfully at: ./hello.py (file state is current in your context — no need to Read it back)' },
      ],
    },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 'toolu_01QrnKX4invmxfyWkjLgF1UV', name: 'Bash', input: { command: 'python3 ./hello.py', description: 'Run hello.py' } },
      ],
    },
  },
  {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_01QrnKX4invmxfyWkjLgF1UV', is_error: false, content: 'hi' },
      ],
    },
  },
  {
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done. `' } },
  },
  {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Done. `./hello.py` was created with `print("hi")` and running `python3 ./hello.py` printed `hi`.' },
      ],
    },
  },
  {
    type: 'result',
    subtype: 'success',
    result: 'Done. `./hello.py` was created with `print("hi")` and running `python3 ./hello.py` printed `hi`.',
    usage: { input_tokens: 3849, output_tokens: 216, cache_read_input_tokens: 47526 },
  },
];

// An SDKResultError (SDKResultMessage's error arm): NO `result` field, carries `errors: string[]`.
// The CLI path never emits this shape; the additive mapClaudeMessage error arm maps errors.join('; ').
export const CLAUDE_SDK_RESULT_ERROR_SAMPLE = {
  type: 'result',
  subtype: 'error_during_execution',
  errors: ['tool Bash failed: exit 1', 'unrecoverable'],
} as const;

// An SDKUserMessageReplay (isReplay:true) — emitted on resume; the adapter SKIPS it to avoid the
// resume double-emit. roro never resumes (persistSession:false), but the skip is pinned regardless.
export const CLAUDE_SDK_USER_REPLAY_SAMPLE = {
  type: 'user',
  isReplay: true,
  message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_replay', is_error: false, content: 'replayed' }] },
} as const;
