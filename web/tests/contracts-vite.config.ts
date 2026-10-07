import {mergeConfig,defineConfig} from 'vite';
import application from '../vite.config';
// Real React components, without a development reload resetting an in-progress
// transactional workflow while other suites or contributors edit shared files.
export default mergeConfig(application,defineConfig({server:{hmr:false,port:5193}}));
