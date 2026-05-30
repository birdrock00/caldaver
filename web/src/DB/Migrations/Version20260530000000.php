<?php

namespace AgenDAV\DB\Migrations;

use Doctrine\DBAL\Migrations\AbstractMigration;
use Doctrine\DBAL\Schema\Schema;

class Version20260530000000 extends AbstractMigration
{
    public function up(Schema $schema)
    {
        if ($schema->hasTable('mail_accounts')) {
            $mailAccounts = $schema->getTable('mail_accounts');
            if (!$mailAccounts->hasColumn('refresh_interval_seconds')) {
                $mailAccounts->addColumn('refresh_interval_seconds', 'integer', ['default' => 60]);
            }
        }

        if ($schema->hasTable('mail_message_cache')) {
            return;
        }

        $cache = $schema->createTable('mail_message_cache');
        $id = $cache->addColumn('id', 'integer');
        $id->setAutoincrement(true);
        $cache->addColumn('owner', 'string', ['length' => 255]);
        $cache->addColumn('account_id', 'integer');
        $cache->addColumn('uid', 'integer');
        $cache->addColumn('position', 'integer', ['default' => 0]);
        $cache->addColumn('from_header', 'text');
        $cache->addColumn('subject', 'text');
        $cache->addColumn('date_header', 'string', ['length' => 255]);
        $cache->addColumn('seen', 'boolean', ['default' => false]);
        $cache->addColumn('attachments', 'text');
        $cache->addColumn('body', 'text', ['notnull' => false]);
        $cache->addColumn('updated_at', 'datetime');
        $cache->setPrimaryKey(['id']);
        $cache->addUniqueIndex(['account_id', 'uid'], 'UNIQ_MAIL_MESSAGE_CACHE_ACCOUNT_UID');
        $cache->addIndex(['owner', 'account_id'], 'IDX_MAIL_MESSAGE_CACHE_OWNER_ACCOUNT');
    }

    public function down(Schema $schema)
    {
        if ($schema->hasTable('mail_message_cache')) {
            $schema->dropTable('mail_message_cache');
        }

        if ($schema->hasTable('mail_accounts') && $schema->getTable('mail_accounts')->hasColumn('refresh_interval_seconds')) {
            $schema->getTable('mail_accounts')->dropColumn('refresh_interval_seconds');
        }
    }
}
