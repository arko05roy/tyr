//! tyr_settlement — links HL orders to users on Solana devnet without revealing stake sizes (PRD 3.4).
//!
//! Sizes and payouts are only ever stored as 32-byte Pedersen commitments; the confidential
//! token movement itself happens in Token-2022 CT instructions assembled client-side and linked
//! to the position by `order_id`.
use anchor_lang::prelude::*;

declare_id!("9MsrEuoEHPJVvfYkWaCuZyzryDvr67XGXeQtk4FXFpxr");

pub const CONFIG_SEED: &[u8] = b"config";
pub const MARKET_SEED: &[u8] = b"market";
pub const POSITION_SEED: &[u8] = b"position";

#[program]
pub mod tyr_settlement {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, relayer: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.relayer = relayer;
        c.paused = false;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_relayer(ctx: Context<AdminOnly>, relayer: Pubkey) -> Result<()> {
        ctx.accounts.config.relayer = relayer;
        emit!(RelayerSet { relayer });
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseSet { paused });
        Ok(())
    }

    /// Admin registers an HL outcome market so positions can reference it.
    pub fn register_market(ctx: Context<RegisterMarket>, market_id: u64) -> Result<()> {
        let m = &mut ctx.accounts.market;
        m.market_id = market_id;
        m.open_positions = 0;
        m.bump = ctx.bumps.market;
        Ok(())
    }

    /// Relayer records an order ↔ user linkage. No plaintext size touches the chain.
    pub fn open_position(
        ctx: Context<OpenPosition>,
        order_id: [u8; 32],
        side: u8,
        size_commitment: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, TyrError::Paused);
        require!(side <= 1, TyrError::InvalidSide);
        let p = &mut ctx.accounts.position;
        p.user = ctx.accounts.user.key();
        p.market = ctx.accounts.market.key();
        p.order_id = order_id;
        p.side = side;
        p.size_commitment = size_commitment;
        p.status = PositionStatus::Open;
        p.outcome = 0;
        p.payout_commitment = [0; 32];
        p.opened_at = Clock::get()?.unix_timestamp;
        p.settled_at = 0;
        p.bump = ctx.bumps.position;
        ctx.accounts.market.open_positions += 1;
        emit!(PositionOpened {
            order_id,
            user: p.user,
            market_id: ctx.accounts.market.market_id,
            side,
            size_commitment,
        });
        Ok(())
    }

    /// Relayer marks a position settled; the payout worker consumes the event.
    pub fn settle_position(
        ctx: Context<SettlePosition>,
        order_id: [u8; 32],
        outcome: u8,
        payout_commitment: [u8; 32],
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, TyrError::Paused);
        let p = &mut ctx.accounts.position;
        require!(p.status == PositionStatus::Open, TyrError::AlreadySettled);
        p.status = PositionStatus::Settled;
        p.outcome = outcome;
        p.payout_commitment = payout_commitment;
        p.settled_at = Clock::get()?.unix_timestamp;
        ctx.accounts.market.open_positions -= 1;
        emit!(PositionSettled {
            order_id,
            user: p.user,
            outcome,
            payout_commitment,
        });
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub relayer: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub market_id: u64,
    pub open_positions: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionStatus {
    Open,
    Settled,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub user: Pubkey,
    pub market: Pubkey,
    pub order_id: [u8; 32],
    pub side: u8,
    pub size_commitment: [u8; 32],
    pub status: PositionStatus,
    pub outcome: u8,
    pub payout_commitment: [u8; 32],
    pub opened_at: i64,
    pub settled_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ TyrError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct RegisterMarket<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ TyrError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, &market_id.to_le_bytes()], bump)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32])]
pub struct OpenPosition<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = relayer @ TyrError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [MARKET_SEED, &market.market_id.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = relayer, space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, user.key().as_ref(), &order_id], bump)]
    pub position: Account<'info, Position>,
    /// CHECK: the bettor; only its key is recorded.
    pub user: UncheckedAccount<'info>,
    #[account(mut)]
    pub relayer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32])]
pub struct SettlePosition<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = relayer @ TyrError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, address = position.market)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [POSITION_SEED, position.user.as_ref(), &order_id], bump = position.bump)]
    pub position: Account<'info, Position>,
    pub relayer: Signer<'info>,
}

#[event]
pub struct PositionOpened {
    pub order_id: [u8; 32],
    pub user: Pubkey,
    pub market_id: u64,
    pub side: u8,
    pub size_commitment: [u8; 32],
}

#[event]
pub struct PositionSettled {
    pub order_id: [u8; 32],
    pub user: Pubkey,
    pub outcome: u8,
    pub payout_commitment: [u8; 32],
}

#[event]
pub struct RelayerSet {
    pub relayer: Pubkey,
}

#[event]
pub struct PauseSet {
    pub paused: bool,
}

#[error_code]
pub enum TyrError {
    #[msg("signer is not authorized for this action")]
    Unauthorized,
    #[msg("program is paused")]
    Paused,
    #[msg("position already settled")]
    AlreadySettled,
    #[msg("side must be 0 (yes) or 1 (no)")]
    InvalidSide,
}
