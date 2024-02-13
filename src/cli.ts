#! /usr/bin/env node
import { program, Command, Argument } from 'commander'
import readline from 'node:readline/promises'
import pg from 'pg'
import evolutions from './index.js'

const apply = new Command('apply')
	.addArgument(new Argument('[folder]', 'Folder with evolutions').default('.'))
	.action(async (folder = '.') => {
		const options = program.optsWithGlobals()
		const client = new pg.Client(options)
		await client.connect()

		const evo = await evolutions.loadFromFiles(folder, client, {
			schema: options.schema,
			allowDown: options.allowDown,
		})

		if ((await evo.hasDown()) && options.allowDown) {
			const ask = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			})
			const answer = await ask.question(
				"You're about to apply down evolutions.\n-- THIS WILL DESTROY DATA --\n Are you sure? (y/N) "
			)
			if (answer.toLowerCase() !== 'y') {
				console.log('Aborted')
				process.exit(2)
			}
		}

		await evo.apply()
	})

const downTo = new Command('down-to')
	.argument('<version>', 'Version to rollback to')
	.action(async version => {
		const options = program.optsWithGlobals()
		const client = new pg.Client(options)
		await client.connect()

		const evo = await evolutions.load([], client, {
			schema: options.schema,
			allowDown: options.allowDown,
		})

		await evo.downTo(version)
	})

const options = new Command('options').action(() => {
	console.log(program.optsWithGlobals())
})

//
program
	.name('evolutions')
	.showHelpAfterError()
	.option('-p, --port <port>', 'Postgres port', '5432')
	.option('-h, --host <host>', 'Postgres host', 'localhost')
	.option('-u, --user <username>', 'Postgres user', 'postgres')
	.option('-w, --password <password>', 'Postgres password', 'postgres')
	.option('-d, --database <database>', 'Postgres database', 'postgres')
	.option('-s, --schema <schema>', 'Database schema', 'public')
	.option(
		'--allow-down',
		"Apply down evolutions. DON'T DO THIS IN PRODUCTION !!!"
	)
	.addCommand(apply)
	.addCommand(options)
	.addCommand(downTo)

program
	.parseAsync()
	.then(() => process.exit(0))
	.catch(err => {
		console.error(err)
		process.exit(1)
	})
//
