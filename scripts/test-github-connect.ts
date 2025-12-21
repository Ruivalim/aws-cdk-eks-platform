/**
 * Test script for connecting a server to GitHub
 */
import { connectServerToGitHub, isServerConnectedToGitHub, getCurrentUser } from '../src/lib/github';

const HOST = 'root@app-server-1-1';
const SERVER_NAME = 'app-server-1';

async function main() {
	console.log('Testing GitHub Connection...\n');

	// Check GitHub token
	console.log('1. Checking GitHub token...');
	try {
		const user = await getCurrentUser();
		console.log(`   ✓ Authenticated as: ${user.login}\n`);
	} catch (error) {
		console.error('   ✗ Failed to authenticate with GitHub');
		console.error(`   ${error}`);
		process.exit(1);
	}

	// Check current connection status
	console.log('2. Checking current connection status...');
	const alreadyConnected = await isServerConnectedToGitHub(HOST);
	console.log(`   ${alreadyConnected ? '✓ Already connected' : '○ Not connected'}\n`);

	// Connect server to GitHub
	console.log('3. Connecting server to GitHub...');
	const result = await connectServerToGitHub(HOST, SERVER_NAME);

	if (result.success) {
		console.log(`   ✓ ${result.message}`);
		console.log(`   Key ID: ${result.keyId}`);
	} else {
		console.error(`   ✗ ${result.message}`);
		if (result.publicKey) {
			console.log(`   Public key generated: ${result.publicKey.substring(0, 50)}...`);
		}
		process.exit(1);
	}

	// Verify connection
	console.log('\n4. Verifying connection...');
	const connected = await isServerConnectedToGitHub(HOST);
	console.log(`   ${connected ? '✓ Connection verified!' : '✗ Connection failed'}`);

	console.log('\n✓ Done!');
}

main().catch(console.error);
