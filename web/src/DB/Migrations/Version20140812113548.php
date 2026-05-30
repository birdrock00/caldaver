<?php

namespace Caldaver\DB\Migrations;

use Doctrine\DBAL\Schema\Schema;
use \Caldaver\DB\Migrations\CaldaverMigration;

class Version20140812113548 extends CaldaverMigration
{
    public function up(Schema $schema)
    {
        $this->skipIf(!$this->upgradingFrom1x(), 'This migration only applies to Caldaver 1.x upgrades');
        $this->write('Migrating from Caldaver 1.x tables');
        $schema->dropTable('sessions');
    }

    public function down(Schema $schema)
    {
        $this->write('Sorry, no way back!');
    }
}
