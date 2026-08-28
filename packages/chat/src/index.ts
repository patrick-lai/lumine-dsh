/**
 * Host stub for the Lumine chat transcript plugin.
 *
 * Browser half ships via `exports["./client"]` and `package.json` `dsh.client`.
 * The empty apply exists so the plugin appears in the host Loader — same
 * pattern as `@deepseek-ai/dsh-client-ui-tool`.
 */
export const name = 'lumine-chat'
export const inject: string[] = []

export function apply(): void {}

export default { name, inject, apply }
