import connectDB, { closeDB } from './config/db';
import { ENV } from './config/env';
import createClobClient from './utils/createClobClient';
import tradeExecutor, { stopTradeExecutor } from './services/tradeExecutor';
import tradeMonitor, { stopTradeMonitor } from './services/tradeMonitor';
import logger from './utils/logger';
import { performHealthCheck, logHealthCheck } from './utils/healthCheck';
import {
    registerPolymarketPricingClobClient,
    preloadNativeTokenPriceModule,
} from './utils/polymarketTokenPrice';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const PROXY_WALLET = ENV.PROXY_WALLET;

// Prevent concurrent shutdown flows from racing each other.
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) {
        logger.warning('Shutdown already in progress, forcing exit...');
        process.exit(1);
    }

    isShuttingDown = true;
    logger.info('Separator');
    logger.info(`Received ${signal}, initiating graceful shutdown...`);

    try {
        // Stop background services first so no new work is queued.
        stopTradeMonitor();
        stopTradeExecutor();

        // Allow in-flight tasks to complete before disconnecting infrastructure.
        logger.info('Waiting for services to finish current operations...');
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Close database connection last for a clean shutdown.
        await closeDB();

        logger.info('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        logger.error(`Error during shutdown: ${error}`);
        process.exit(1);
    }
};

// Capture async promise errors that were not explicitly awaited/caught.
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
    // Keep process alive so the service can attempt recovery.
});

// Capture sync runtime crashes and shut down in a controlled way.
process.on('uncaughtException', (error: Error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    // For uncaught exceptions, force a shutdown because runtime state may be invalid.
    gracefulShutdown('uncaughtException').catch(() => {
        process.exit(1);
    });
});

// Respect container/process manager stop signals.
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export const main = async () => {
    try {
        // Print quick onboarding hints in interactive runs.
        const colors = {
            reset: '\x1b[0m',
            yellow: '\x1b[33m',
            cyan: '\x1b[36m',
        };

        console.log(`\n${colors.yellow}💡 First time running the bot?${colors.reset}`);
        console.log(`   Read the guide: ${colors.cyan}GETTING_STARTED.md${colors.reset}`);
        console.log(`   Run health check: ${colors.cyan}npm run health-check${colors.reset}\n`);

        await connectDB();
        logger.info(`${USER_ADDRESSES.join(', ')} - ${PROXY_WALLET}`);

        // Run health checks before enabling monitor/executor loops.
        logger.info('Performing initial health check...');
        const healthResult = await performHealthCheck();
        logHealthCheck(healthResult);

        if (!healthResult.healthy) {
            logger.warning('Health check failed, but continuing startup...');
        }

        logger.info('Initializing CLOB client...');
        const clobClient = await createClobClient();
        logger.info('CLOB client ready');

        registerPolymarketPricingClobClient(clobClient);

        const nativePrice = preloadNativeTokenPriceModule();
        if (nativePrice.loaded && nativePrice.loadedPath) {
            logger.info(
                `Native token price module loaded: ${nativePrice.loadedPath} [${nativePrice.exportKeys.join(', ') || 'no exports'}]`
            );
        } else {
            logger.warning(
                `Native token price module not loaded [${nativePrice.platformTriplet}] ${nativePrice.primaryLoadError ?? 'failed'} — midpoint calls will use HTTP (CLOB) fallback`
            );
        }

        logger.info('Separator');
        logger.info('Starting trade monitor...');
        tradeMonitor();

        logger.info('Starting trade executor...');
        tradeExecutor(clobClient);

        // test(clobClient);
    } catch (error) {
        logger.error(`Fatal error during startup: ${error}`);
        await gracefulShutdown('startup-error');
    }
};

main();
