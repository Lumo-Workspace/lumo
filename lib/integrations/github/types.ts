/**
 * Public types for the GitHub integration module.
 */

/**
 * A parsed task identifier split into its component parts.
 * E.g. "ENG-123" → { teamIdentifier: "ENG", number: 123 }
 */
export interface SplitIdentifier {
  teamIdentifier: string
  number: number
}
