import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
function fixture() {
  const tx = { user: { update: jest.fn() }, profile: { update: jest.fn() } };
  const prisma = {
    $transaction: jest.fn(async (fn: (x: typeof tx) => unknown) => fn(tx)),
  };
  const service = new UsersService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(service as never, 'ensureProfile' as never)
    .mockResolvedValue({} as never);
  jest.spyOn(service, 'getMyProfile').mockResolvedValue({} as never);
  return { tx, prisma, service };
}
describe('Profile username and gender editing', () => {
  it('normalizes usernames and validates their format', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      username: '  Pavithra_Photo  ',
      gender: 'FEMALE',
    });
    expect(dto.username).toBe('pavithra_photo');
    expect(await validate(dto)).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateProfileDto, { username: 'bad name' }),
      ),
    ).not.toHaveLength(0);
  });
  it('changes gender without touching photo locks, verification or generated identity', async () => {
    const f = fixture();
    await f.service.updateMyProfile('me', {
      gender: 'FEMALE',
      username: 'my_handle',
    });
    expect(f.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'me' },
      data: { gender: 'FEMALE', username: 'my_handle' },
    });
  });
  it('translates a racing username collision into a useful conflict', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002' }) as never,
    );
    await expect(
      f.service.updateMyProfile('me', { username: 'taken' }),
    ).rejects.toThrow('already taken');
  });
});
