import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const phone = `+23324555${Math.floor(1000 + (Date.now() % 9000))}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('signs up via phone OTP, reaches T1, and reads /me', async () => {
    const otpRes = await request(app.getHttpServer())
      .post('/v1/auth/request-otp')
      .send({ phone })
      .expect(201);
    const code = otpRes.body.debugCode as string;
    expect(code).toMatch(/^\d{6}$/);

    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/verify-otp')
      .send({ phone, code })
      .expect(201);
    expect(verifyRes.body.tier).toBe('T1');
    const token = verifyRes.body.accessToken as string;
    expect(token).toBeTruthy();

    const meRes = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(meRes.body.phone).toBe(phone);
    expect(meRes.body.verificationTier).toBe('T1');

    const unauth = await request(app.getHttpServer()).get('/v1/me').expect(401);
    expect(unauth.body.error.code).toBe('UNAUTHORIZED');
  });
});
