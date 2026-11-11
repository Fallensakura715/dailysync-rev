import { BARK_KEY_DEFAULT } from './constant';
import { syncGarminGlobal2GarminCN } from './utils/garmin_global';
import { wreqRequest } from './utils/wreq_client';

const core = require('@actions/core');
const BARK_KEY = process.env.BARK_KEY ?? BARK_KEY_DEFAULT;

syncGarminGlobal2GarminCN().catch((e) => {
    wreqRequest(
        `https://api.day.app/${BARK_KEY}/Garmin CN -> Garmin Global 同步数据运行失败了，快去检查！/${e.message}`).catch(() => {});
    core.setFailed(e.message);
    process.exit(1);
});




