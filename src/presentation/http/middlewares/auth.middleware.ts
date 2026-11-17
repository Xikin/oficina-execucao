import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors';
import { ROLES_INTERNOS, type RoleToken } from '../../../domain/enums/role.enum';
import { EMISSOR_INTERNO } from '../../../domain/auth/emissores';

interface UsuarioAutenticado {
  sub: string;
  role: RoleToken;
  iss?: string;
}

export async function exigirInterno(req: FastifyRequest, _rep: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    throw new UnauthorizedError('Token inválido ou expirado');
  }

  const usuario = req.user as unknown as UsuarioAutenticado;
  if (usuario.iss !== EMISSOR_INTERNO || !ROLES_INTERNOS.includes(usuario.role)) {
    req.log.warn(
      { evento: 'acesso_negado', motivo: 'rota_interna', role: usuario.role, sub: usuario.sub },
      'token sem papel interno tentou acessar o serviço de execução',
    );
    throw new ForbiddenError('Rota restrita a usuários da oficina');
  }
}
