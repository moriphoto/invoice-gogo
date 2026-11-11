import { getStore } from '@netlify/blobs';
import { createApi } from '../lib/handler.mjs';
import { SETUP_CODE_HASH } from '../lib/setup-code.mjs';

const api = createApi({
  getStore: name => getStore({ name, consistency: 'strong' }),
  env: {
    IGG_SECRET: Netlify.env.get('IGG_SECRET'),                 // optional: overrides the auto-generated signing key
    IGG_PIN_HASH: Netlify.env.get('IGG_PIN_HASH'),             // optional: fixes the PIN from the environment
    IGG_SETUP_CODE: Netlify.env.get('IGG_SETUP_CODE'),         // optional: plain setup code
    IGG_SETUP_CODE_HASH: Netlify.env.get('IGG_SETUP_CODE_HASH') || SETUP_CODE_HASH
  }
});

export default async (req, context) => api(req, { ip: context.ip });

export const config = { path: ['/api', '/api/*'] };
