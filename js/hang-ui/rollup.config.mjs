import nodeResolve from '@rollup/plugin-node-resolve';
import esbuild from 'rollup-plugin-esbuild';
import { string } from 'rollup-plugin-string';
import solid from 'unplugin-solid/rollup';

export default [
    {
        input: 'src/Components/publish/element.tsx',
        output: {
            file: 'dist/publish-controls.esm.js',
            format: 'es',
            sourcemap: true,
        },
        plugins: [
            string({ include: '**/*.css' }),
            solid({ dev: false, hydratable: false }),
            esbuild({
                include: /\.[jt]sx?$/, // .js, .ts, .jsx, .tsx
                jsx: 'preserve', // let unplugin-solid handle JSX
                tsconfig: 'tsconfig.json', // optional; mainly for paths/aliases
            }),
            nodeResolve({ extensions: ['.js', '.ts', '.tsx'] }),
        ],
    },
    {
        input: 'src/Components/watch/element.tsx',
        output: {
            file: 'dist/watch-controls.esm.js',
            format: 'es',
            sourcemap: true,
        },
        plugins: [
            string({ include: '**/*.css' }),
            solid({ dev: false, hydratable: false }),
            esbuild({
                include: /\.[jt]sx?$/, // .js, .ts, .jsx, .tsx
                jsx: 'preserve', // let unplugin-solid handle JSX
                tsconfig: 'tsconfig.json', // optional; mainly for paths/aliases
            }),
            nodeResolve({ extensions: ['.js', '.ts', '.tsx'] }),
        ],
    },
];
