export function createUserMessage(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, id: 'message-1', role: 'user' }
}
