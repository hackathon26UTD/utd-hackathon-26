import { profilePhotoHandler } from '../../../src/profile-photo.js';
export const onRequest = context => profilePhotoHandler(context, 'customer');
