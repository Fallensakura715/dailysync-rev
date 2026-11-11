import { BARK_KEY_DEFAULT } from './constant';
import { syncAllGarminCN2GarminGlobal } from './utils/garmin_cn';
import { wreqRequest } from './utils/wreq_client';

const core = require('@actions/core');
const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

const main = async () => {
    try {
        await syncAllGarminCN2GarminGlobal();
    } catch (e) {
        wreqRequest(
            `https://api.day.app/${BARK_KEY}/Garmin CN -> Garmin Global 全量同步数据运行失败了，快去检查！/${e.message}`);
        core.setFailed(e.message);
        throw new Error(e);
    }
};

main();
