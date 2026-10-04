// Whether the availability grid currently has unsaved edits. A plain module-level flag rather than
// React state: it's only read at the moment of an action that would throw the edits away (e.g. a
// time zone switch that reloads the grid), so nothing needs to re-render when it changes.
let unsaved = false;

export function setUnsavedChanges(value) {
  unsaved = value;
}

export function hasUnsavedChanges() {
  return unsaved;
}

export const LEAVE_WARNING = 'You have unsaved changes to your availability. Leave without saving?';
