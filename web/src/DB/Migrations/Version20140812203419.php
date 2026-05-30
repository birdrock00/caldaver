<?php

namespace Caldaver\DB\Migrations;

use Doctrine\DBAL\Schema\Schema;
use \Caldaver\DB\Migrations\CaldaverMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
class Version20140812203419 extends CaldaverMigration
{
    public function up(Schema $schema)
    {
        $this->skipIf(!$this->upgradingFrom1x(), 'This migration only applies to Caldaver 1.x upgrades');
        $this->write('Removing old Caldaver 1.x tables');
        $schema->dropTable('migrations');
        $schema->dropTable('shared');
    }

    public function down(Schema $schema)
    {
        $this->write('Sorry, no way back!');
    }
}
