import logger from '@overleaf/logger'

logger.debug({}, 'Enable Online Compile (browser-based WASM TeX compilation)')

/**
 * @import { WebModule } from "../../types/web-module"
 */

/** @type {WebModule} */
const OnlineCompileModule = {}

export default OnlineCompileModule
