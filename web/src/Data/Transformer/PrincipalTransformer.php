<?php

namespace Caldaver\Data\Transformer;

/*
 * Copyright (C) Jorge López Pérez <jorge@adobo.org>
 *
 *  This file is part of Caldaver.
 *
 *  Caldaver is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  any later version.
 *
 *  Caldaver is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with Caldaver.  If not, see <http://www.gnu.org/licenses/>.
 */

use League\Fractal;
use Caldaver\Data\Principal;


class PrincipalTransformer extends Fractal\TransformerAbstract
{
    public function transform(Principal $principal)
    {
        $result = [
            'url' => $principal->getUrl(),
            'displayname' => $principal->getDisplayName(),
            'email' => $principal->getEmail(),
        ];

        return $result;
    }
}
