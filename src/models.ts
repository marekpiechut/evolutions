export type Logger = {
	debug: (msg: string, ...args: unknown[]) => void
	info: (msg: string, ...args: unknown[]) => void
	warn: (msg: string, ...args: unknown[]) => void
	error: (error: unknown, msg: string, ...args: unknown[]) => void
}

export type Config = {
	schema?: string
	allowDown?: boolean
	ignoreDown?: boolean
}

export const DEFAULT_CONFIG = {
	schema: 'public',
	allowDown: false,
}

export type EvolutionExpression = string

export type Evolution = {
	ups: EvolutionExpression[]
	downs?: EvolutionExpression[]
}

export type LoadedEvolution = Evolution & {
	checksum: string
	version: number
}
