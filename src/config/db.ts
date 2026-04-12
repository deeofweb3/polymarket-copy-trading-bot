import dns from 'node:dns';
import mongoose from 'mongoose';
import { ENV } from './env';
import chalk from '@tsjunk/chalk';

const uri = ENV.MONGO_URI || 'mongodb://localhost:27017/polymarket_copytrading';

const connectOpts = {
    serverSelectionTimeoutMS: 20_000,
} as const;

const printSrvFailureTips = (): void => {
    console.log(
        chalk.yellow('\nTip:'),
        'mongodb+srv:// uses DNS SRV records; some networks block or mis-resolve them.'
    );
    console.log(
        '     Set MONGO_DNS_SERVERS=8.8.8.8,1.1.1.1 to force resolvers, or use Atlas’s'
    );
    console.log(
        '     standard mongodb://host:27017,... connection string, or try another network.\n'
    );
};

const connectDB = async () => {
    const tryConnect = async () => {
        await mongoose.connect(uri, connectOpts);
    };

    try {
        await tryConnect();
        console.log(chalk.green('✓'), 'MongoDB connected');
        return;
    } catch (firstError) {
        const msg =
            firstError instanceof Error ? firstError.message : String(firstError);
        const isSrvDnsFailure =
            uri.startsWith('mongodb+srv') &&
            (msg.includes('querySrv') ||
                (msg.includes('ECONNREFUSED') && msg.includes('_mongodb._tcp')));

        if (isSrvDnsFailure) {
            const custom = process.env.MONGO_DNS_SERVERS?.split(/[\s,]+/).filter(
                Boolean
            );
            const fallbackDns = custom?.length
                ? custom
                : ['8.8.8.8', '8.8.4.4', '1.1.1.1'];
            const previousDns = dns.getServers();
            console.log(
                chalk.yellow('MongoDB:'),
                'SRV DNS lookup failed; retrying with',
                fallbackDns.join(', ')
            );
            try {
                dns.setServers(fallbackDns);
                await mongoose.disconnect().catch(() => {});
                await tryConnect();
                dns.setServers(previousDns);
                console.log(chalk.green('✓'), 'MongoDB connected');
                return;
            } catch (retryError) {
                await mongoose.disconnect().catch(() => {});
                dns.setServers(previousDns);
                console.log(chalk.red('✗'), 'MongoDB connection failed:', retryError);
                printSrvFailureTips();
                process.exit(1);
            }
        }

        console.log(chalk.red('✗'), 'MongoDB connection failed:', firstError);
        if (msg.includes('querySrv') || msg.includes('ECONNREFUSED')) {
            printSrvFailureTips();
        }
        process.exit(1);
    }
};

/**
 * Close the MongoDB connection gracefully.
 * Useful during process shutdown so pending operations can finish cleanly.
 */
export const closeDB = async (): Promise<void> => {
    try {
        await mongoose.connection.close();
        console.log(chalk.green('✓'), 'MongoDB connection closed');
    } catch (error) {
        console.log(chalk.red('✗'), 'Error closing MongoDB connection:', error);
    }
};

export default connectDB;
