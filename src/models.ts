type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'ERROR'
export type Logger = (level: LogLevel, msg: string, ...args: unknown[]) => void

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
