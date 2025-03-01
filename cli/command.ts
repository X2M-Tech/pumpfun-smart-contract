import { program } from "commander";
import { PublicKey } from "@solana/web3.js";
import {
  configProject,
  createBondingCurve,
  setClusterConfig,
  swap,
  initMigrationTx,
  getCurrentPrice,
  calculateSwap,
} from "./scripts";

// Constants
const DEFAULT_ENV = "devnet";
const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEFAULT_KEYPAIR = "./keys/3uHJMHzeiqdqQ3LNc5bNVxuCp224HGtStPkv1JUEcabr.json";

// Types
interface CommandOptions {
  env: string;
  keypair: string;
  rpc: string;
  mint?: string;
  token?: string;
  amount?: number;
  style?: string;
}

// Helper function to validate required parameters
const validateRequiredParams = (params: Record<string, any>, required: string[]): void => {
  for (const param of required) {
    if (params[param] === undefined) {
      throw new Error(`Missing required parameter: ${param}`);
    }
  }
};

// Helper function to log cluster configuration
const logClusterConfig = (options: CommandOptions): void => {
  console.log("Solana Cluster:", options.env);
  console.log("Keypair Path:", options.keypair);
  console.log("RPC URL:", options.rpc);
};

program.version("0.0.1");

// Base command configuration
function programCommand(name: string) {
  return program
    .command(name)
    .option(
      "-e, --env <string>",
      "Solana cluster env name",
      DEFAULT_ENV
    )
    .option(
      "-r, --rpc <string>",
      "Solana cluster RPC name",
      DEFAULT_RPC
    )
    .option(
      "-k, --keypair <string>",
      "Solana wallet Keypair Path",
      DEFAULT_KEYPAIR
    );
}

// Migrate command
programCommand('migrate')
  .requiredOption('-m, --mint <string>', 'Token mint address')
  .action(async (directory, cmd) => {
    try {
      const options = cmd.opts() as CommandOptions;
      await setClusterConfig(options.env, options.keypair, options.rpc);
      const migrateTxId = await initMigrationTx(options.mint!);
      console.log("Transaction ID:", migrateTxId);
    } catch (error) {
      console.error("Migration failed:", error);
      process.exit(1);
    }
  });

// Config command
programCommand("config")
  .action(async (directory, cmd) => {
    try {
      const options = cmd.opts() as CommandOptions;
      logClusterConfig(options);
      await setClusterConfig(options.env, options.keypair, options.rpc);
      await configProject();
    } catch (error) {
      console.error("Configuration failed:", error);
      process.exit(1);
    }
  });

// Curve command
programCommand("curve")
  .action(async (directory, cmd) => {
    try {
      const options = cmd.opts() as CommandOptions;
      logClusterConfig(options);
      await setClusterConfig(options.env, options.keypair, options.rpc);
      await createBondingCurve();
    } catch (error) {
      console.error("Bonding curve creation failed:", error);
      process.exit(1);
    }
  });

// Swap command
programCommand("swap")
  .option("-t, --token <string>", "token address")
  .option("-a, --amount <number>", "swap amount")
  .option("-s, --style <string>", "0: buy token, 1: sell token")
  .action(async (directory, cmd) => {
    try {
      const options = cmd.opts() as CommandOptions;
      logClusterConfig(options);
      
      validateRequiredParams(options, ['token', 'amount', 'style']);
      
      await setClusterConfig(options.env, options.keypair, options.rpc);
      await swap(new PublicKey(options.token!), options.amount!, options.style!);
    } catch (error) {
      console.error("Swap failed:", error);
      process.exit(1);
    }
  });

// Get current price command
programCommand('getCurrentPrice')
  .requiredOption('-m, --mint <string>', 'Token mint address')
  .action(async (directory, cmd) => {
    try {
      const options = cmd.opts() as CommandOptions;
      await setClusterConfig(options.env, options.keypair, options.rpc);
      const currentPrice = await getCurrentPrice(options.mint!);
      console.log("Current Price:", currentPrice);
    } catch (error) {
      console.error("Failed to get current price:", error);
      process.exit(1);
    }
  });

// Calculate swap command
programCommand('calculateSwap')
  .requiredOption("-a, --amount <number>", "swap amount")
  .requiredOption('-m, --mint <string>', 'Token mint address')
  .action(async (directory, cmd) => {
    try {
      const options = cmd.opts() as CommandOptions;
      await setClusterConfig(options.env, options.keypair, options.rpc);
      const tokenOutAmount = await calculateSwap(options.mint!, options.amount!);
      console.log("Token Out Amount:", tokenOutAmount);
    } catch (error) {
      console.error("Failed to calculate swap:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);

/*
Usage examples:
  yarn script config
  yarn script curve
  yarn script getCurrentPrice -m 63cCGWfEDvqebwXQCzt6fVWWpV4VkJJiFRHwCBLD35hE
  yarn script calculateSwap -m 63cCGWfEDvqebwXQCzt6fVWWpV4VkJJiFRHwCBLD35hE -a 2
  yarn script swap -t 63cCGWfEDvqebwXQCzt6fVWWpV4VkJJiFRHwCBLD35hE -a 2000000000 -s 0
  yarn script migrate -m 63cCGWfEDvqebwXQCzt6fVWWpV4VkJJiFRHwCBLD35hE
*/