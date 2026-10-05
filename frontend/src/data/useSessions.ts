// Components-facing sessions seam (P6.1): session CRUD through data/use*.ts.
export {
  compactSession,
  createSession,
  deleteSession,
  getSession,
  listSessions,
  renameSession,
} from './api/sessions'
export type { Session } from './api/sessions'
