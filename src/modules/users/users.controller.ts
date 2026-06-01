import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GrantRoleDto } from './dto/grant-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getById(user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.users.updateProfile(user.id, dto);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  list(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.users.list(take ? Number(take) : 50, skip ? Number(skip) : 0);
  }

  @Get('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  getOne(@Param('id') id: string) {
    return this.users.getById(id);
  }

  @Post('users/:id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  grant(@Param('id') id: string, @Body() dto: GrantRoleDto) {
    return this.users.grantRole(id, dto.role);
  }

  @Delete('users/:id/roles/:role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  revoke(@Param('id') id: string, @Param('role') role: Role) {
    return this.users.revokeRole(id, role);
  }
}
