import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { MAP_PROVIDER, NoMapProvider, type MapProvider } from './map.provider';
import { GoogleMapProvider } from './google.provider';

@Global()
@Module({
  providers: [
    {
      provide: MAP_PROVIDER,
      inject: [AppConfig],
      useFactory: (c: AppConfig): MapProvider => (c.get('MAP_PROVIDER') === 'google' ? new GoogleMapProvider(c.get('GOOGLE_MAPS_KEY')!) : new NoMapProvider()),
    },
  ],
  exports: [MAP_PROVIDER],
})
export class MapsModule {}
