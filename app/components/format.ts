/**
 * Display helpers shared between the worklist screens and the workflow workspace, so the same
 * value is not formatted two different ways depending on which screen shows it.
 */

/**
 * Actors are stored as `Name <address>` so an audit record identifies the account beyond doubt.
 * Repeating the address on every one of thousands of movement or timeline rows crowds out the
 * columns that actually differ, so screens show the name and keep the stored label as the
 * element's title attribute.
 */
export function actorName(label: string) {
  return label.replace(/\s*<[^>]*>\s*$/, "").trim() || label;
}
