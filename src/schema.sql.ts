import { Config, EvolutionExpression } from './models.js'

export default (config: Config): EvolutionExpression[] => [
	`CREATE SCHEMA IF NOT EXISTS ${config.schema}`,
	`CREATE TABLE IF NOT EXISTS ${config.schema}.EVOLUTIONS (
		version INTEGER NOT NULL,
		checksum VARCHAR(64),
		applied TIMESTAMP NOT NULL DEFAULT NOW(),
		ups JSONB,
		downs JSONB,
		PRIMARY KEY(version)
	)`,
]
