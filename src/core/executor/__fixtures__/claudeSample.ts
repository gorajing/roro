// src/executor/__fixtures__/claudeSample.ts — hand-built claude stream-json sample mirroring the
// documented SDKMessage shapes (claude 2.1.x; a live capture needs ANTHROPIC_API_KEY). Shared by the
// standalone check.ts script AND the CI mapper test (fixtures.test.ts) — one copy, two consumers.
export const CLAUDE_STREAM_SAMPLE: unknown[] = [
    { type: 'system', subtype: 'init', session_id: 'sess_abc123' },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: "I'll create " } },
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: "I'll create hello.py for you." },
          { type: 'tool_use', id: 'tu_1', name: 'Write', input: { file_path: '/tmp/x/hello.py', content: 'print("hi")' } },
        ],
      },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: false, content: 'File created' }] },
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'python3 hello.py' } }],
      },
    },
    {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', is_error: false, content: 'hi\n' }] },
    },
    { type: 'result', subtype: 'success', result: 'Created hello.py and verified it prints hi.', usage: { input_tokens: 10 } },
];
