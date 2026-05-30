<?php

namespace Caldaver\DB\Migrations;

use Doctrine\DBAL\Schema\Schema;
use \Caldaver\DB\Migrations\CaldaverMigration;

/**
 * Auto-generated Migration: Please modify to your needs!
 */
class Version20140812200547 extends CaldaverMigration
{
    public function up(Schema $schema)
    {
        $this->skipIf(!$this->upgradingFrom1x(), 'This migration only applies to Caldaver 1.x upgrades');
        $this->write('Migrating the old shared table');

        $platform = $this->connection->getDatabasePlatform();

        if ($platform->getName() === 'mysql') {
            $sql = 'INSERT INTO shares (`sid`, `owner`, `calendar`, `with`, `options`, `rw`) SELECT'
                .' `sid`, `user_from`, `calendar`, `user_which`, `options`, `write_access` FROM shared';
        } else {
            $sql = 'INSERT INTO shares (sid, owner, calendar, "with", options, rw) SELECT'
                .' sid, user_from, calendar, user_which, options, write_access FROM shared';
        }

        $this->addSql($sql);
    }

    public function down(Schema $schema)
    {
        $this->write('Sorry, no way back!');
    }
}
