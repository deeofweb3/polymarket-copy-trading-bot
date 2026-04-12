import * as dotenv from 'dotenv';

dotenv.config();

import { ENV } from '../config/env';
import { getPolymarketTokenMidpointPrice } from '../utils/polymarketTokenPrice';
import logger from '../utils/logger';

/**
 * CLI: fetch midpoint price for a Polymarket outcome token id.
 *
 * Usage:
 *   npm run check-token-price -- <token_id>
 *   TOKEN_ID=... npm run check-token-price
 */
const main = async () => {
    const fromArgv = process.argv[2];
    const tokenId = fromArgv || process.env.TOKEN_ID;
    if (!tokenId || tokenId.trim() === '') {
        logger.error(
            'Usage: npm run check-token-price -- <token_id>\n   or: TOKEN_ID=<token_id> npm run check-token-price'
        );
        process.exit(1);
    }

    logger.info(`CLOB: ${ENV.CLOB_HTTP_URL}`);
    logger.info(`Token ID: ${tokenId}\n`);

    const mid = await getPolymarketTokenMidpointPrice(tokenId.trim());
    if (mid === null) {
        logger.error('Could not resolve midpoint (null response).');
        process.exit(1);
    }

    logger.info(`Midpoint: ${mid}`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
