use crate::share::Share;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SharesDiff {
    current_shares: Vec<Share>,
    keep: Vec<Share>,
    remove: Vec<Share>,
}

impl SharesDiff {
    pub fn new(current_shares: Vec<Share>) -> Self {
        Self {
            current_shares,
            keep: Vec::new(),
            remove: Vec::new(),
        }
    }

    pub fn decide(&mut self, input: Vec<Share>) {
        self.keep.clear();
        self.remove.clear();

        let mut pending_inputs = (0..input.len()).collect::<Vec<_>>();

        for current_share in &self.current_shares {
            let mut found_position = None;

            for (pending_position, input_index) in pending_inputs.iter().enumerate() {
                if input[*input_index].shared_with() == current_share.shared_with() {
                    found_position = Some((pending_position, *input_index));
                    break;
                }
            }

            if let Some((pending_position, input_index)) = found_position {
                let mut kept_share = current_share.clone();
                kept_share.set_write_permission(input[input_index].is_writable());
                self.keep.push(kept_share);
                pending_inputs.remove(pending_position);
            } else {
                self.remove.push(current_share.clone());
            }
        }

        for input_index in pending_inputs {
            self.keep.push(input[input_index].clone());
        }
    }

    pub fn kept_shares(&self) -> &[Share] {
        &self.keep
    }

    pub fn marked_for_removal(&self) -> &[Share] {
        &self.remove
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_and_existing_shares_have_empty_diff() {
        let mut diff = SharesDiff::new(vec![]);

        diff.decide(vec![]);

        assert_eq!(diff.kept_shares().len(), 0);
        assert_eq!(diff.marked_for_removal().len(), 0);
    }

    #[test]
    fn adds_all_new_shares() {
        let input = generate_shares(4, 0);
        let mut diff = SharesDiff::new(vec![]);

        diff.decide(input.clone());

        assert_eq!(diff.kept_shares().len(), 4);
        assert_eq!(diff.marked_for_removal().len(), 0);
        assert_same_share_set(diff.kept_shares(), &input);
    }

    #[test]
    fn adds_one_new_share_to_existing_shares() {
        let input = generate_shares(5, 0);
        let existing = vec![
            input[2].clone(),
            input[0].clone(),
            input[3].clone(),
            input[1].clone(),
        ];
        let mut diff = SharesDiff::new(existing);

        diff.decide(input.clone());

        assert_eq!(diff.kept_shares().len(), 5);
        assert_eq!(diff.marked_for_removal().len(), 0);
        assert_same_share_set(diff.kept_shares(), &input);
    }

    #[test]
    fn removes_missing_existing_share() {
        let existing = generate_shares(5, 0);
        let input = vec![
            existing[3].clone(),
            existing[1].clone(),
            existing[0].clone(),
            existing[2].clone(),
        ];
        let mut diff = SharesDiff::new(existing.clone());

        diff.decide(input.clone());

        assert_eq!(diff.kept_shares().len(), 4);
        assert_eq!(diff.marked_for_removal().len(), 1);
        assert_same_share_set(diff.kept_shares(), &input);
        assert_eq!(diff.marked_for_removal(), &[existing[4].clone()]);
    }

    #[test]
    fn alters_existing_share_without_removing_it() {
        let existing = generate_shares(3, 0);
        let mut input = existing.clone();
        let writable = !input[0].is_writable();
        input[0].set_write_permission(writable);
        input = vec![input[2].clone(), input[0].clone(), input[1].clone()];
        let mut diff = SharesDiff::new(existing);

        diff.decide(input.clone());

        assert_eq!(diff.kept_shares().len(), 3);
        assert_eq!(diff.marked_for_removal().len(), 0);
        assert_same_share_set(diff.kept_shares(), &input);
    }

    #[test]
    fn adds_removes_and_alters_in_one_diff() {
        let existing = generate_shares(4, 0);
        let mut input = existing.clone();
        input.remove(0);
        let writable = !input[0].is_writable();
        input[0].set_write_permission(writable);
        input.push(generate_shares(1, 4).remove(0));
        input = vec![
            input[2].clone(),
            input[0].clone(),
            input[3].clone(),
            input[1].clone(),
        ];
        let mut diff = SharesDiff::new(existing.clone());

        diff.decide(input.clone());

        assert_eq!(diff.kept_shares().len(), 4);
        assert_eq!(diff.marked_for_removal().len(), 1);
        assert_same_share_set(diff.kept_shares(), &input);
        assert_same_share_set(diff.marked_for_removal(), &[existing[0].clone()]);
    }

    fn generate_shares(n: usize, start: usize) -> Vec<Share> {
        (start..start + n)
            .map(|index| {
                let mut share = Share::new();
                share
                    .set_with(format!("/with-{index}"))
                    .set_calendar("/calendar")
                    .set_owner("/me");
                share.set_write_permission(index % 2 == 0);
                share
            })
            .collect()
    }

    fn assert_same_share_set(first: &[Share], second: &[Share]) {
        assert_eq!(first.len(), second.len());

        for expected in second {
            assert!(
                first.iter().any(|actual| {
                    actual.shared_with() == expected.shared_with()
                        && actual.is_writable() == expected.is_writable()
                }),
                "missing share {:?}",
                expected.shared_with()
            );
        }
    }
}
