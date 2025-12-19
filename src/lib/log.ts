import chalk from 'chalk';

export const log = {
	info: (msg: string) => console.log(chalk.blue('ℹ'), msg),
	success: (msg: string) => console.log(chalk.green('✓'), msg),
	warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
	error: (msg: string) => console.log(chalk.red('✗'), msg),
	step: (msg: string) => console.log(chalk.cyan('→'), msg),
	header: (msg: string) => console.log(chalk.bold.underline(`\n${msg}\n`)),
	dim: (msg: string) => console.log(chalk.dim(msg)),
};

export default log;
