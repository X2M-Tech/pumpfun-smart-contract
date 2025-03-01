import * as anchor from "@coral-xyz/anchor";
import { BN, Program, web3 } from "@coral-xyz/anchor";
import fs from "fs";

import { Keypair, Connection, PublicKey, SystemProgram, TransactionInstruction, SYSVAR_RENT_PUBKEY, ComputeBudgetProgram, Transaction, TransactionMessage, AddressLookupTableProgram, VersionedTransaction } from "@solana/web3.js";

import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";

import { PumpMeteora } from "../target/types/pump_meteora";
import {
  createConfigTx,
  createBondingCurveTx,
  swapTx,
} from "../lib/scripts";
import { execTx } from "../lib/util";
import {
  TEST_DECIMALS,
  TEST_INIT_BONDING_CURVE,
  TEST_NAME,
  TEST_SYMBOL,
  TEST_TOKEN_SUPPLY,
  TEST_URI,
  TEST_VIRTUAL_RESERVES,
  TEST_INITIAL_VIRTUAL_TOKEN_RESERVES,
  TEST_INITIAL_VIRTUAL_SOL_RESERVES,
  TEST_INITIAL_REAL_TOKEN_RESERVES,
  SEED_BONDING_CURVE,
  SEED_CONFIG,
  TEST_INITIAL_METEORA_TOKEN_RESERVES,
  TEST_INITIAL_METEORA_SOL_AMOUNT,
} from "../lib/constant";
import { createMarket } from "../lib/create-market";
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { web3JsRpc } from '@metaplex-foundation/umi-rpc-web3js';
import { keypairIdentity, publicKey, transactionBuilder, TransactionBuilder, Umi } from '@metaplex-foundation/umi';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { fromWeb3JsKeypair, toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import AmmImpl, { PROGRAM_ID } from '@mercurial-finance/dynamic-amm-sdk';
import VaultImpl, { getVaultPdas } from '@mercurial-finance/vault-sdk';
import { SEEDS, METAPLEX_PROGRAM } from '@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/constants';
import { createProgram } from "@mercurial-finance/dynamic-amm-sdk/dist/cjs/src/amm/utils";
import { derivePoolAddressWithConfig, getOrCreateATAInstruction, deriveMintMetadata, deriveLockEscrowPda} from './util'

// Type definitions
interface AmountConfig<T> {
  range: {
    min: T;
    max: T;
  };
}

interface Config {
  authority: PublicKey;
  migrationAuthority: PublicKey;
  teamWallet: PublicKey;
  migrationWallet: PublicKey;
  initBondingCurve: BN;
  platformBuyFee: number;
  platformSellFee: number;
  platformMigrationFee: number;
  lamportAmountConfig: AmountConfig<BN>;
  tokenSupplyConfig: AmountConfig<BN>;
  tokenDecimalsConfig: AmountConfig<number>;
  initialVirtualTokenReservesConfig: BN;
  initialVirtualSolReservesConfig: BN;
  initialRealTokenReservesConfig: BN;
  initialMeteoraTokenReserves: BN;
  initialMeteoraSolAmount: BN;
  curveLimit: BN;
  initialized: boolean;
}

interface CurveData {
  virtualSolReserves: BN;
  virtualTokenReserves: BN;
  realSolReserves: BN;
  realTokenReserves: BN;
}

// Global state
let solConnection: Connection | null = null;
let program: Program<PumpMeteora> | null = null;
let payer: NodeWallet | null = null;
let provider: anchor.Provider | null = null;
let umi: Umi | null = null;
let programId: string | null = null;

// Address of the deployed program.
let programId;

/**
 * Sets up the cluster configuration and initializes program connections
 * @param cluster - The Solana cluster to connect to (e.g., 'mainnet-beta', 'devnet')
 * @param keypairPath - Path to the wallet keypair file
 * @param rpc - Optional custom RPC endpoint URL
 * @throws {Error} If keypair file cannot be read or if connection setup fails
 */
export const setClusterConfig = async (
  cluster: web3.Cluster,
  keypairPath: string,
  rpc?: string
): Promise<void> => {
  try {
    // Initialize connection
    solConnection = new web3.Connection(
      rpc || web3.clusterApiUrl(cluster),
      { commitment: "confirmed" }
    );

    // Load and validate keypair
    const keypairData = await fs.promises.readFile(keypairPath, "utf-8");
    const walletKeypair = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(keypairData)),
      { skipValidation: true }
    );
    payer = new NodeWallet(walletKeypair);

    console.log("Wallet Address:", payer.publicKey.toBase58());

    // Initialize provider
    provider = new anchor.AnchorProvider(
      solConnection,
      payer,
      {
        skipPreflight: true,
        commitment: "confirmed",
      }
    );
    anchor.setProvider(provider);

    // Initialize Umi
    const rpcUrl = rpc || web3.clusterApiUrl(cluster);
    umi = createUmi(rpcUrl).use(web3JsRpc(provider.connection));

    // Initialize program
    program = anchor.workspace.PumpMeteora as Program<PumpMeteora>;
    programId = program.programId.toBase58();
    console.log("ProgramId:", programId);

  } catch (error) {
    console.error("Failed to set cluster config:", error);
    throw new Error(`Cluster configuration failed: ${error.message}`);
  }
};

/**
 * Configures the project with initial settings
 * @throws {Error} If configuration transaction fails
 */
export const configProject = async (): Promise<void> => {
  if (!program || !payer || !solConnection) {
    throw new Error("Program not initialized. Call setClusterConfig first.");
  }

  try {
    const teamWallet = new PublicKey("Br4NUsLoHRgAcxTBsDwgnejnjqMe5bkyio1YCrM3gWM2");
    const migrationWallet = new PublicKey("DQ8fi6tyN9MPD5bpSpUXxKd9FVRY2WcnoniVEgs6StEW");

    const newConfig: Config = {
      authority: payer.publicKey,
      migrationAuthority: payer.publicKey,
      teamWallet,
      migrationWallet,
      initBondingCurve: new BN(TEST_INIT_BONDING_CURVE),
      platformBuyFee: 0.69,
      platformSellFee: 0.69,
      platformMigrationFee: 0.69,
      lamportAmountConfig: {
        range: { 
          min: new BN(15_000_000_000), 
          max: new BN(20_000_000_000) 
        },
      },
      tokenSupplyConfig: {
        range: { 
          min: new BN(1_000_000_000), 
          max: new BN(1_000_000_000) 
        },
      },
      tokenDecimalsConfig: { 
        range: { min: 6, max: 6 } 
      },
      initialVirtualTokenReservesConfig: new BN(TEST_INITIAL_VIRTUAL_TOKEN_RESERVES),
      initialVirtualSolReservesConfig: new BN(TEST_INITIAL_VIRTUAL_SOL_RESERVES),
      initialRealTokenReservesConfig: new BN(TEST_INITIAL_REAL_TOKEN_RESERVES),
      initialMeteoraTokenReserves: new BN(TEST_INITIAL_METEORA_TOKEN_RESERVES),
      initialMeteoraSolAmount: new BN(TEST_INITIAL_METEORA_SOL_AMOUNT),
      curveLimit: new BN(62_000_000_000),
      initialized: false,
    };

    const tx = await createConfigTx(
      payer.publicKey,
      newConfig,
      solConnection,
      program
    );

    await execTx(tx, solConnection, payer);
    console.log("Project configuration completed successfully");
  } catch (error) {
    console.error("Failed to configure project:", error);
    throw new Error(`Project configuration failed: ${error.message}`);
  }
};

/**
 * Creates a new bonding curve with specified parameters
 * @throws {Error} If bonding curve creation fails or if program is not initialized
 */
export const createBondingCurve = async (): Promise<void> => {
  if (!program || !payer || !solConnection) {
    throw new Error("Program not initialized. Call setClusterConfig first.");
  }

  try {
    const configPda = PublicKey.findProgramAddressSync(
      [Buffer.from(SEED_CONFIG)],
      program.programId
    )[0];
    
    const configAccount = await program.account.config.fetch(configPda);
    console.log("Config account fetched successfully");

    const tx = await createBondingCurveTx(
      TEST_DECIMALS,
      TEST_TOKEN_SUPPLY,
      TEST_VIRTUAL_RESERVES,
      TEST_NAME,
      TEST_SYMBOL,
      TEST_URI,
      payer.publicKey,
      configAccount.teamWallet,
      solConnection,
      program
    );

    await execTx(tx, solConnection, payer);
    console.log("Bonding curve created successfully");
  } catch (error) {
    console.error("Failed to create bonding curve:", error);
    throw new Error(`Bonding curve creation failed: ${error.message}`);
  }
};

/**
 * Performs a token swap operation
 * @param token - The token mint address to swap
 * @param amount - The amount to swap
 * @param style - The swap direction (1 for buy, 0 for sell)
 * @throws {Error} If swap operation fails or if program is not initialized
 */
export const swap = async (
  token: PublicKey,
  amount: number,
  style: number
): Promise<void> => {
  if (!program || !payer || !solConnection) {
    throw new Error("Program not initialized. Call setClusterConfig first.");
  }

  if (amount <= 0) {
    throw new Error("Swap amount must be greater than 0");
  }

  if (style !== 0 && style !== 1) {
    throw new Error("Invalid swap style. Must be 0 (sell) or 1 (buy)");
  }

  try {
    const tx = await swapTx(
      payer.publicKey,
      token,
      amount,
      style,
      solConnection,
      program
    );

    await execTx(tx, solConnection, payer);
    console.log(`Swap operation completed successfully (${style === 1 ? 'buy' : 'sell'})`);
  } catch (error) {
    console.error("Failed to perform swap:", error);
    throw new Error(`Swap operation failed: ${error.message}`);
  }
};

export const METEORA_CONFIG = publicKey("BdfD7rrTZEWmf8UbEBPVpvM3wUqyrR8swjAy5SNT8gJ2");

export const initMigrationTx = async (mint: string) => {
  const { ammProgram, vaultProgram } = createProgram(provider.connection, null);
  const eventAuthority = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], new PublicKey(PROGRAM_ID))[0];

  // const global_config = PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];

  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_CONFIG)],
    program.programId
  )[0];
  const configAccount = await program.account.config.fetch(configPda);
  console.log("configAccount: ", configAccount);

  const tokenAMint = NATIVE_MINT;

  // Needs to be dynamic
  const tokenBMint = new PublicKey(mint);

  // Needs to as defined in smart contract
  const config = toWeb3JsPublicKey(METEORA_CONFIG);
  const feeReceiver = configAccount.migrationWallet;

  const bondingCurve = PublicKey.findProgramAddressSync([Buffer.from(SEED_BONDING_CURVE), tokenBMint.toBytes()], program.programId)[0];

  const bondingCurvedata = await program.account.bondingCurve.fetch(bondingCurve);


  const poolPubkey = derivePoolAddressWithConfig(tokenAMint, tokenBMint, config, ammProgram.programId);

  const [
      { vaultPda: aVault, tokenVaultPda: aTokenVault, lpMintPda: aLpMintPda },
      { vaultPda: bVault, tokenVaultPda: bTokenVault, lpMintPda: bLpMintPda },
  ] = [getVaultPdas(tokenAMint, vaultProgram.programId), getVaultPdas(tokenBMint, vaultProgram.programId)];

  let aVaultLpMint = aLpMintPda;
  let bVaultLpMint = bLpMintPda;
  let preInstructions: Array<TransactionInstruction> = [];

  // Vault creation Ixs
  const [aVaultAccount, bVaultAccount] = await Promise.all([
      vaultProgram.account.vault.fetchNullable(aVault),
      vaultProgram.account.vault.fetchNullable(bVault),
  ]);

  if (!aVaultAccount) {
      const createVaultAIx = await VaultImpl.createPermissionlessVaultInstruction(provider.connection, payer.publicKey, tokenAMint);
      createVaultAIx && preInstructions.push(createVaultAIx);

  } else {
      aVaultLpMint = aVaultAccount.lpMint; // Old vault doesn't have lp mint pda
  }
  if (!bVaultAccount) {
      const createVaultBIx = await VaultImpl.createPermissionlessVaultInstruction(provider.connection, payer.publicKey, tokenBMint);
      createVaultBIx && preInstructions.push(createVaultBIx);

  } else {
      bVaultLpMint = bVaultAccount.lpMint; // Old vault doesn't have lp mint pda
  }

  const [lpMint] = PublicKey.findProgramAddressSync(
      [Buffer.from(SEEDS.LP_MINT), poolPubkey.toBuffer()],
      ammProgram.programId,
  );
  const [[aVaultLp], [bVaultLp]] = [
      PublicKey.findProgramAddressSync([aVault.toBuffer(), poolPubkey.toBuffer()], ammProgram.programId),
      PublicKey.findProgramAddressSync([bVault.toBuffer(), poolPubkey.toBuffer()], ammProgram.programId),
  ];

  const [[payerTokenB, payerTokenBIx], [payerTokenA, payerTokenAIx]] = await Promise.all([
      getOrCreateATAInstruction(tokenBMint, payer.publicKey, provider.connection ),
      getOrCreateATAInstruction(tokenAMint, payer.publicKey, provider.connection ),
  ]);


  // Create Native Mint SOL ATA for sol escrow
  payerTokenAIx && preInstructions.push(payerTokenAIx);
  payerTokenBIx && preInstructions.push(payerTokenBIx);

  const [feeReceiverTokenAccount, feeReceiverTokenAccountIx] = await getOrCreateATAInstruction(tokenBMint, feeReceiver, provider.connection, payer.publicKey);
  feeReceiverTokenAccountIx && preInstructions.push(feeReceiverTokenAccountIx);


  const bondingCurveTokenB = getAssociatedTokenAddressSync(tokenBMint, bondingCurve, true);

  const [[protocolTokenAFee], [protocolTokenBFee]] = [
      PublicKey.findProgramAddressSync(
          [Buffer.from(SEEDS.FEE), tokenAMint.toBuffer(), poolPubkey.toBuffer()],
          ammProgram.programId,
      ),
      PublicKey.findProgramAddressSync(
          [Buffer.from(SEEDS.FEE), tokenBMint.toBuffer(), poolPubkey.toBuffer()],
          ammProgram.programId,
      ),
  ];

  // LP ata of bonding curve
  const payerPoolLp = getAssociatedTokenAddressSync(lpMint,  payer.publicKey);

  const setComputeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 20_000_000,
  });
  let latestBlockHash = await provider.connection.getLatestBlockhash(
      provider.connection.commitment,
  );

  if (preInstructions.length) {
      const preInstructionTx = new Transaction({
          feePayer: payer.publicKey,
          ...latestBlockHash,
      }).add(...preInstructions);

      preInstructionTx.sign(payer.payer);
      const preInxSim = await solConnection.simulateTransaction(preInstructionTx)

      const txHash = await provider.sendAndConfirm(preInstructionTx, [], {
          commitment: "finalized",
      });
  }

  const [mintMetadata, _mintMetadataBump] = deriveMintMetadata(lpMint);
  const [tokenBMetadata, _tokenBMetadataBump] = deriveMintMetadata(lpMint);

  console.log("bondingCurvedata.creator", bondingCurvedata.creator.toBase58());
  // Escrow for claim authority Payer
  const [lockEscrowPK] = deriveLockEscrowPda(poolPubkey, bondingCurvedata.creator, ammProgram.programId);
  const [escrowAta, createEscrowAtaIx] = await getOrCreateATAInstruction(lpMint, lockEscrowPK, solConnection, payer.publicKey);

  console.log("lockEscrowPK : {?}, escrowAta : {?}", lockEscrowPK, escrowAta);

  const [lockEscrowPK1] = deriveLockEscrowPda(poolPubkey,  feeReceiver, ammProgram.programId);
  const [escrowAta1, createEscrowAtaIx1] = await getOrCreateATAInstruction(lpMint, lockEscrowPK1, solConnection, payer.publicKey);

  console.log("lockEscrowPK1 : {?}, escrowAta1 : {?}", lockEscrowPK1, escrowAta1);

  console.log("create txLockPool  transaction start");

  const txLockPool = await program.methods
      .lockPool()
      .accounts({
          tokenMint: tokenBMint,
          pool: poolPubkey,
          lpMint,
          aVaultLp,
          bVaultLp,
          tokenBMint,
          aVault,
          bVault,
          aVaultLpMint,
          bVaultLpMint,
          payerPoolLp,
          payer: payer.publicKey,
          authority: payer.publicKey,
          feeReceiver: configAccount.migrationWallet,
          creatorReceiver: bondingCurvedata.creator,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          lockEscrow: lockEscrowPK,
          lockEscrow1: lockEscrowPK1,
          escrowVault: escrowAta,
          escrowVault1: escrowAta1,
          meteoraProgram: PROGRAM_ID,
          eventAuthority,
      })
      .transaction();

  console.log("create txLockPool  transaction end");

  console.log("create txCreatePool  transaction start");
      
  const txCreatePool = await program.methods
      .createPool()
      .accounts({
          tokenMint: tokenBMint,
          teamWallet: configAccount.teamWallet,
          pool: poolPubkey,
          config,
          lpMint,
          aVaultLp,
          bVaultLp,
          tokenAMint,
          tokenBMint,
          aVault,
          bVault,
          aVaultLpMint,
          bVaultLpMint,
          payerTokenA,
          payerTokenB,
          payerPoolLp,
          protocolTokenAFee,
          protocolTokenBFee,
          payer: payer.publicKey,
          authority: payer.publicKey,
          mintMetadata,
          rent: SYSVAR_RENT_PUBKEY,
          metadataProgram: METAPLEX_PROGRAM,
          vaultProgram: vaultProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          meteoraProgram: PROGRAM_ID,
          eventAuthority,
      })
      .transaction();

  console.log("create txCreatePool transaction end");


  /// create meteora pool ///
  const creatTx = new web3.Transaction({
      feePayer: payer.publicKey,
      ...latestBlockHash,
  }).add(setComputeUnitLimitIx).add(txCreatePool)

  const slot = await provider.connection.getSlot()

  const [lookupTableInst, lookupTableAddress] =
      AddressLookupTableProgram.createLookupTable({
          authority: payer.publicKey,
          payer: payer.publicKey,
          recentSlot: slot - 200,
      });

  const addresses = [
      poolPubkey,
      config,
      lpMint,
      tokenAMint,
      tokenBMint,
      aVault,
      bVault,
      aTokenVault,
      bTokenVault,
      aVaultLp,
      bVaultLp,
      aVaultLpMint,
      bVaultLpMint,
      payerTokenA,
      payerTokenB,
      payerPoolLp,
      protocolTokenAFee,
      protocolTokenBFee,
      payer.publicKey,
      mintMetadata,
      SYSVAR_RENT_PUBKEY,
      METAPLEX_PROGRAM,
      vaultProgram.programId,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
      SystemProgram.programId,
      new PublicKey(PROGRAM_ID),
  ]

  const addAddressesInstruction1 = AddressLookupTableProgram.extendLookupTable({
      payer: payer.publicKey,
      authority: payer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: addresses.slice(0, 30)
  });

  latestBlockHash = await provider.connection.getLatestBlockhash(
      provider.connection.commitment,
  );

  const lutMsg1 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockHash.blockhash,
      instructions: [lookupTableInst, addAddressesInstruction1]
  }).compileToV0Message();

  const lutVTx1 = new VersionedTransaction(lutMsg1);
  lutVTx1.sign([payer.payer])

  const lutId1 = await provider.connection.sendTransaction(lutVTx1)
  const lutConfirm1 = await provider.connection.confirmTransaction(lutId1, 'finalized')
  await sleep(2000);
  const lookupTableAccount = await provider.connection.getAddressLookupTable(lookupTableAddress, { commitment: 'finalized' })

  const createTxMsg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockHash.blockhash,
      instructions: creatTx.instructions
  }).compileToV0Message([lookupTableAccount.value]);

  const createVTx = new VersionedTransaction(createTxMsg);
  createVTx.sign([payer.payer])

  const sim = await provider.connection.simulateTransaction(createVTx, { sigVerify: true })

  console.log('migrate sim', sim)
  const id = await provider.connection.sendTransaction(createVTx, { skipPreflight: false })
  console.log('migrate id', id)
  const confirm = await provider.connection.confirmTransaction(id)
  console.log('migrate confirm', confirm)

  /// create meteora pool ///
  const lockTx = new web3.Transaction({
    feePayer: payer.publicKey,
    ...latestBlockHash,
}).add(setComputeUnitLimitIx).add(txLockPool)

  //// lock pool /////
  const lockPoolTxMsg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockHash.blockhash,
      instructions: lockTx.instructions
      // }).compileToV0Message();
  }).compileToV0Message([lookupTableAccount.value]);

  const lockPoolVTx = new VersionedTransaction(lockPoolTxMsg);
  lockPoolVTx.sign([payer.payer])

  const lockPoolSim = await provider.connection.simulateTransaction(lockPoolVTx, { sigVerify: true })
  console.log('lockPoolSim', lockPoolSim)
  const lockPoolId = await provider.connection.sendTransaction(lockPoolVTx, { skipPreflight: true })
  console.log('lockPoolId', lockPoolId)
  const lockPoolConfirm = await provider.connection.confirmTransaction(lockPoolId)
  console.log('lockPoolConfirm', lockPoolConfirm)

  return lockPoolId;
}

/**
 * Calculates the price based on virtual reserves
 * @param virtualTokenReserves - Virtual token reserves
 * @param virtualSolReserves - Virtual SOL reserves
 * @returns The calculated price
 * @throws {Error} If virtual SOL reserves is zero
 */
const calcPrice = (
  virtualTokenReserves: BN,
  virtualSolReserves: BN
): number => {
  if (virtualSolReserves.isZero()) {
    throw new Error("Cannot calculate price: virtual SOL reserves is zero");
  }

  return virtualSolReserves.toNumber() / virtualTokenReserves.toNumber() / 1000;
};

/**
 * Gets the current price for a token
 * @param mint - The token mint address
 * @returns The current price
 * @throws {Error} If price calculation fails or if program is not initialized
 */
export const getCurrentPrice = async (mint: string): Promise<number> => {
  if (!program) {
    throw new Error("Program not initialized. Call setClusterConfig first.");
  }

  try {
    const tokenBMint = new PublicKey(mint);
    const bondingCurvePda = PublicKey.findProgramAddressSync(
      [Buffer.from(SEED_BONDING_CURVE), tokenBMint.toBytes()],
      program.programId
    )[0];

    const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);
    const curveData: CurveData = {
      virtualSolReserves: bondingCurve.virtualSolReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves,
      realSolReserves: bondingCurve.realSolReserves,
      realTokenReserves: bondingCurve.realTokenReserves,
    };

    console.log("Curve data:", curveData);
    const currentPrice = calcPrice(curveData.virtualTokenReserves, curveData.virtualSolReserves);
    console.log("Current Price:", currentPrice);
    return currentPrice;
  } catch (error) {
    console.error("Failed to get current price:", error);
    throw new Error(`Price calculation failed: ${error.message}`);
  }
};

// Constants for token calculations
const SCALE_UP = new BN(1_000_000_000);  // Scale tokens to 9 decimals
const SCALE_DOWN = new BN(1_000_000);    // Convert back to 6 decimals

/**
 * Calculates the number of tokens to receive for a given SOL amount
 * @param virtualSolReserves - Virtual SOL reserves
 * @param virtualTokenReserves - Virtual token reserves
 * @param solAmount - Amount of SOL to swap
 * @returns The number of tokens to receive, or null if calculation fails
 */
const calculateTokensOut = (
  virtualSolReserves: BN,
  virtualTokenReserves: BN,
  solAmount: BN
): BN | null => {
  try {
    // Convert token reserves to 9 decimal places
    const currentSol = virtualSolReserves;
    const currentTokens = virtualTokenReserves.mul(SCALE_UP).div(SCALE_DOWN);

    if (currentTokens.isZero()) return null;

    // Calculate new reserves using constant product formula
    const newSol = currentSol.add(solAmount);
    const newTokens = currentSol.mul(currentTokens).div(newSol);

    // Tokens to be received
    let tokensOut = currentTokens.sub(newTokens);

    // Convert back to 6 decimal places
    tokensOut = tokensOut.mul(SCALE_DOWN).div(SCALE_UP);

    return tokensOut;
  } catch (error) {
    console.error("Token calculation error:", error);
    return null;
  }
};

/**
 * Converts SOL amount to BN with proper scaling
 * @param solAmount - Amount of SOL
 * @returns BN representation of the SOL amount
 */
const solAmountToBN = (solAmount: number): BN => {
  return new BN(solAmount);
};

/**
 * Calculates the swap amount for a given SOL input
 * @param mint - The token mint address
 * @param solAmount - Amount of SOL to swap
 * @returns The calculated token amount, or null if calculation fails
 * @throws {Error} If calculation fails or if program is not initialized
 */
export const calculateSwap = async (mint: string, solAmount: number): Promise<BN | null> => {
  if (!program) {
    throw new Error("Program not initialized. Call setClusterConfig first.");
  }

  if (solAmount <= 0) {
    return null;
  }

  try {
    const tokenBMint = new PublicKey(mint);
    const bondingCurvePda = PublicKey.findProgramAddressSync(
      [Buffer.from(SEED_BONDING_CURVE), tokenBMint.toBytes()],
      program.programId
    )[0];

    const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);
    const curveData: CurveData = {
      virtualSolReserves: bondingCurve.virtualSolReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves,
      realSolReserves: bondingCurve.realSolReserves,
      realTokenReserves: bondingCurve.realTokenReserves,
    };

    console.log("Curve data:", curveData);

    // Apply platform fee
    solAmount -= solAmount * 0.0069; // 0.69% fee
    console.log("Updated SOL Amount:", solAmount);

    const solAmountBN = solAmountToBN(solAmount);
    console.log("SOL Amount BN:", solAmountBN.toString());

    let tokensOut = calculateTokensOut(
      curveData.virtualSolReserves,
      curveData.virtualTokenReserves,
      solAmountBN
    );
    
    if (tokensOut && tokensOut.gte(curveData.realTokenReserves)) {
      console.log("Real token reserves limit reached:", {
        calculated: tokensOut.toString(),
        limit: curveData.realTokenReserves.toString()
      });
      tokensOut = curveData.realTokenReserves;
    }

    console.log("Tokens Out:", tokensOut?.toString());
    return tokensOut;
  } catch (error) {
    console.error("Failed to calculate swap:", error);
    throw new Error(`Swap calculation failed: ${error.message}`);
  }
};

/**
 * Utility function to pause execution
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
} 