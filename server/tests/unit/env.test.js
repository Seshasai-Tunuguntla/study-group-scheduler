const { isPreviewWithoutOwnDatabase, missingEnv } = require('../../src/env');
const { migrationPlan } = require('../../scripts/migrateDeploy');

const PRODUCTION_DB = { DATABASE_URL: 'postgres://pooled/prod', DATABASE_URL_UNPOOLED: 'postgres://direct/prod' };

test('missingEnv names the required settings that are missing', () => {
  expect(missingEnv({ DATABASE_URL: 'x' })).toEqual(['JWT_SECRET']);
  expect(missingEnv({ DATABASE_URL: 'x', JWT_SECRET: 'y' })).toEqual([]);
});

describe('isPreviewWithoutOwnDatabase', () => {
  test.each([
    [{ VERCEL_ENV: 'preview' }, true],
    [{ VERCEL_ENV: 'preview', PREVIEW_HAS_OWN_DATABASE: 'false' }, true],
    [{ VERCEL_ENV: 'preview', PREVIEW_HAS_OWN_DATABASE: 'true' }, false], // opted in: a Neon preview branch
    [{ VERCEL_ENV: 'production' }, false],
    [{ VERCEL_ENV: 'development' }, false], // `vercel dev` on your own machine
    [{}, false], // not on Vercel: local development, CI
  ])('%j -> %s', (env, expected) => {
    expect(isPreviewWithoutOwnDatabase(env)).toBe(expected);
  });
});

describe('migrationPlan (the Vercel build step)', () => {
  test('a preview build never migrates, even if it can see the production database', () => {
    expect(migrationPlan({ VERCEL_ENV: 'preview', ...PRODUCTION_DB })).toEqual({
      run: false,
      reason: 'Preview deployment: migrations skipped (previews never migrate the production database)',
    });
  });

  test('a production build migrates over the direct (unpooled) connection', () => {
    expect(migrationPlan({ VERCEL_ENV: 'production', ...PRODUCTION_DB })).toEqual({ run: true, url: 'postgres://direct/prod' });
  });

  test('without a direct connection it uses DATABASE_URL', () => {
    expect(migrationPlan({ DATABASE_URL: 'postgres://local' })).toEqual({ run: true, url: 'postgres://local' });
  });

  test('a preview with its own database migrates that database', () => {
    const branch = { DATABASE_URL: 'postgres://pooled/branch', DATABASE_URL_UNPOOLED: 'postgres://direct/branch' };
    expect(migrationPlan({ VERCEL_ENV: 'preview', PREVIEW_HAS_OWN_DATABASE: 'true', ...branch })).toEqual({
      run: true,
      url: 'postgres://direct/branch',
    });
  });

  test('a production build without a database fails, instead of going live unmigrated', () => {
    expect(migrationPlan({ VERCEL_ENV: 'production' })).toEqual({
      run: false,
      error: 'Set DATABASE_URL (and DATABASE_URL_UNPOOLED for Neon) to run migrations',
    });
  });
});
