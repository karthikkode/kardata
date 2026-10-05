// Re-exports the frontend rule set so e2e specs lint under the same rules
// (flat config only matches files under its own directory).
export { default } from '../../frontend/eslint.config.js'
