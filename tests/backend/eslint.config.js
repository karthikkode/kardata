// Re-exports the backend rule set so root-level backend tests lint under
// the same rules (flat config only matches files under its own directory).
export { default } from '../../backend/eslint.config.js'
