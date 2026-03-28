/**
 * Greet utility function
 */

/**
 * Returns a greeting string for the given name.
 * If name is empty, returns "Hello, World!"
 */
export function greet(name: string): string {
  if (!name) {
    return 'Hello, World!'
  }
  return `Hello, ${name}!`
}
