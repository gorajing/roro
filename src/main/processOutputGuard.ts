// Imported first by src/main.ts so even early startup diagnostics are protected.
import { installBrokenPipeGuard } from './processOutput';

installBrokenPipeGuard();
