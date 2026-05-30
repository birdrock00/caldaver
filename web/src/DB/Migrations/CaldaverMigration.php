<?php

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

namespace Caldaver\DB\Migrations;

use Doctrine\DBAL\Migrations\AbstractMigration;

abstract class CaldaverMigration extends AbstractMigration
{
    /**
     * Checks if there is a table named 'migrations', which suggests we were
     * using Caldaver 1.x
     *
     * @return bool
     */
    protected function upgradingFrom1x()
    {
        $tables = $this->connection->getSchemaManager()->listTables();

        foreach ($tables as $table) {
            if ($table->getName() == 'migrations') {
                return true;
            }
        }

        return false;
    }
}
