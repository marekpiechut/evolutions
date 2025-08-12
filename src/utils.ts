import { Logger } from 'models'

export const consoleLogger: Logger = (level, msg, ...args) => {
	switch (level) {
		case 'INFO':
			console.log(`INFO: ${msg}`, ...args)
			break
		case 'DEBUG':
			console.debug(`DEBUG: ${msg}`, ...args)
			break
		case 'WARN':
			console.warn(`WARN: ${msg}`, ...args)
			break
		case 'ERROR':
			console.error(`ERROR: ${msg}`, ...args)
			break
	}
}
