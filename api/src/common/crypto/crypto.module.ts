import { Global, Module } from "@nestjs/common";
import { CryptoService } from "./crypto.service";

/** Marked @Global so any service can `@Inject(CryptoService)` without
 *  forcing every module that touches a secret to import CryptoModule. */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
