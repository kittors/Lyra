/**
 * The flag that marks a process as the sandbox runner rather than anything else.
 *
 * In a file of its own so the runner's entry can name it without importing the backend, and the
 * backend can name it without importing the runner.
 */
export const SANDBOX_RUNNER_FLAG = "--lyra-sandbox-runner";
