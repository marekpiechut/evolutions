import crypto from 'node:crypto'
import { EvolutionExpression } from 'models'

export const generateChecksum = (sqls: EvolutionExpression[]): string => {
	const sql = sqls
		.map(s => s.trim())
		.filter(Boolean)
		.join('; ')

	return crypto.createHash('sha1').update(sql).digest('hex')
}
