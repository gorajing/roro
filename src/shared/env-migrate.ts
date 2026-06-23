// src/shared/env-migrate.ts — side-effect module: run the COMPANION_* -> RORO_* migration AT IMPORT.
//
// Imported FIRST in the main entry (right after dotenv, before electron / window / executor imports)
// so the rename's back-compat applies before any module reads these vars at load time.
import { migrateLegacyEnv } from './env';

migrateLegacyEnv();
