import pg from 'pg'
import { Config, Evolution, LoadedEvolution } from './models.js'

import { generateChecksum } from './checksum.js'
import { Evolutions } from './evolutions.js'
import { parseFiles } from './files.js'

export const load = async (
	sqls: Evolution[],
	client: pg.ClientBase,
	config?: Config
): Promise<Evolutions> => {
	const evolutions = await loadEvolutions(sqls)
	return new Evolutions(client, evolutions, config)
}

export const loadFromFiles = async (
	filesOrFolder: string | string[],
	client: pg.ClientBase,
	config?: Config
): Promise<Evolutions> => {
	const sqls = await parseFiles(filesOrFolder)
	return load(sqls, client, config)
}

const loadEvolutions = async (
	evolutions: Evolution[]
): Promise<LoadedEvolution[]> => {
	return evolutions.map((evo, i) => ({
		...evo,
		checksum: generateChecksum(evo.ups),
		version: i + 1,
	}))
}

export default {
	load,
	loadFromFiles,
}
